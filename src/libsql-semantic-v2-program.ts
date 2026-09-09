import { Effect, Exit } from "effect";
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
  renderOhCloudflareEmbeddingDocumentV1,
  renderOhCloudflareEmbeddingQueryV1,
  type OhCloudflareEmbeddingClientV1,
  type OhRenderedEmbeddingInputV1,
} from "./cloudflare-embedding";
import type { OhLibSqlResultV1, OhLibSqlStatementV1 } from "./libsql";
import { normalizeOhEmbeddingV1 } from "./semantic-model";
import {
  OH_LIBSQL_SEMANTIC_LIMITS_V2,
  OhLibSqlSemanticV2Error,
  OhSemanticAuthorityRefV2,
  OhSemanticDocumentV2,
  OhSemanticStageResultV2,
  OhSemanticPublishResultV2,
  OhSemanticPublishedHeadV2,
  OhSemanticSearchResultV2,
  OhSemanticPurgeResultV2,
  SCHEMA_NAME_V1,
  SCHEMA_VERSION_V1,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  GENERATION_KIND,
  MEMBERSHIP_KIND,
  TRANSITION_PAGE_SIZE,
  TRANSITION_TABLE_NAME,
  SCHEMA_TABLE,
  TRANSITION_TABLE,
  SCHEMA_STATEMENTS,
  normalizedSchemaSql,
  SchemaObject,
  EXPECTED_SCHEMA_OBJECTS,
  SCHEMA_SHA256,
  EXPECTED_SCHEMA_OBJECTS_V1,
  SCHEMA_SHA256_V1,
  EXPECTED_TRANSITION_SCHEMA_OBJECTS,
  rowValue,
  integer,
  rowsAffected,
  parseAuthorityId,
  deriveOhSemanticIsolationSha256V2,
  isolationSha256,
  purgeMarkerSha256,
  parseRecordKey,
  parseGeneration,
  parseDigest,
  parseInstant,
  LegacyPurge,
  vectorBytes,
  storedBytes,
  decodeVector,
  Membership,
  Generation,
  StoredGeneration,
  StoredHead,
  parseStoredGeneration,
  generationMatches,
  parseStoredHead,
  headMatchesGeneration,
  GENERATION_SELECT,
  HEAD_SELECT,
  purgeResult,
  StoredVector,
  validateEmbeddingClient,
} from "./libsql-semantic-v2-model";
import {
  SemanticCacheSql,
  SemanticCacheClock,
  SemanticCacheEmbedding,
  semanticCacheFailure,
  semanticCacheValue,
  type SemanticCacheFailure,
  type SemanticCacheSqlService,
  type SemanticCacheClockService,
} from "./libsql-semantic-v2-platform";
function schemaObjects(client: SemanticCacheSqlService): Effect.Effect<readonly SchemaObject[], SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const result = (yield* client.execute(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name GLOB 'oh_semantic_*' OR tbl_name GLOB 'oh_semantic_*')
    ORDER BY type, name`));
    return (yield* semanticCacheValue(() => result.rows.map((row) => {
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
      .localeCompare(canonicalJson([right.type, right.name])))));
  });
}
function verifySchemaRevision(client: SemanticCacheSqlService, revision: Readonly<{
  expected: readonly SchemaObject[];
  name: string;
  schemaSha256: Sha256Hex;
  version: number;
}>): Effect.Effect<void, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const marker = (yield* Effect.mapError(client.execute({
      args: [revision.version],
      sql: "SELECT name, schema_sha256 FROM oh_semantic_schemas WHERE version = ?",
    }), () => semanticCacheFailure(new OhLibSqlSemanticV2Error("schema-unavailable", "The semantic cache schema is unavailable."))));
    const row = marker.rows[0];
    if (marker.rows.length !== 1 || row === undefined
      || rowValue(row, "name", 0) !== revision.name
      || rowValue(row, "schema_sha256", 1) !== revision.schemaSha256) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("schema-unavailable", "The semantic cache schema marker is invalid.")));
    }
    const actualObjects = (yield* schemaObjects(client));
    if ((yield* semanticCacheValue(() => canonicalJson(actualObjects))) !== (yield* semanticCacheValue(() => canonicalJson(revision.expected)))) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic cache schema has drifted.")));
    }
  });
}
export function verifySchema(): Effect.Effect<void, SemanticCacheFailure, SemanticCacheSql> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const transition = (yield* client.execute({
      args: [TRANSITION_TABLE_NAME],
      sql: "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?",
    }));
    if (transition.rows.length !== 0) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("schema-unavailable", "The semantic V2 cache upgrade is still materializing purge custody.")));
    }
    (yield* verifySchemaRevision(client, {
      expected: EXPECTED_SCHEMA_OBJECTS,
      name: SCHEMA_NAME,
      schemaSha256: SCHEMA_SHA256,
      version: SCHEMA_VERSION,
    }));
  });
}
function transitionPage(client: SemanticCacheSqlService): Effect.Effect<readonly LegacyPurge[], SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const result = (yield* client.execute({
      args: [TRANSITION_PAGE_SIZE],
      sql: `SELECT authority_id, purged_at FROM oh_semantic_v1_purge_transition
      ORDER BY authority_id LIMIT ?`,
    }));
    return (yield* semanticCacheValue(() => Object.freeze(result.rows.map((row) => {
      const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
      const purgedAt = parseCanonicalInstantV1(rowValue(row, "purged_at", 1));
      if (authorityId === null || purgedAt === null) {
        throw new OhLibSqlSemanticV2Error("integrity", "A semantic v1 purge marker is invalid.");
      }
      return Object.freeze({ authorityId, purgedAt });
    }))));
  });
}
function verifyTransitionSchema(client: SemanticCacheSqlService): Effect.Effect<void, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const actualObjects = (yield* schemaObjects(client));
    if ((yield* semanticCacheValue(() => canonicalJson(actualObjects)))
      !== (yield* semanticCacheValue(() => canonicalJson(EXPECTED_TRANSITION_SCHEMA_OBJECTS)))) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic V2 transition schema has drifted.")));
    }
    const markers = (yield* client.execute("SELECT version FROM oh_semantic_schemas ORDER BY version LIMIT 1"));
    if (markers.rows.length !== 0) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic V2 marker cannot exist during purge transition.")));
    }
  });
}
function startSemanticCacheV1ToV2Transition(client: SemanticCacheSqlService): Effect.Effect<void, SemanticCacheFailure, SemanticCacheSql> {
  return Effect.gen(function*() {
    const attempt = (yield* Effect.exit(Effect.gen(function*() {
      (yield* verifySchemaRevision(client, {
        expected: EXPECTED_SCHEMA_OBJECTS_V1,
        name: SCHEMA_NAME_V1,
        schemaSha256: SCHEMA_SHA256_V1,
        version: SCHEMA_VERSION_V1,
      }));
      (yield* client.batch([
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
      ], "write"));
    })));
    if (Exit.isFailure(attempt)) {
      const inventory = (yield* schemaObjects(client));
      if ((yield* semanticCacheValue(() => canonicalJson(inventory))) === (yield* semanticCacheValue(() => canonicalJson(EXPECTED_SCHEMA_OBJECTS)))) {
        (yield* verifySchema());
        return;
      }
      if ((yield* semanticCacheValue(() => canonicalJson(inventory))) !== (yield* semanticCacheValue(() => canonicalJson(EXPECTED_TRANSITION_SCHEMA_OBJECTS)))) {
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic V1-to-V2 transition did not begin atomically.")));
      }
    }
    (yield* verifyTransitionSchema(client));
  });
}
function materializeTransitionPage(client: SemanticCacheSqlService, purges: readonly LegacyPurge[]): Effect.Effect<void, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const statements: OhLibSqlStatementV1[] = [];
    for (const purge of purges) {
      const isolation = (yield* semanticCacheValue(() => deriveOhSemanticIsolationSha256V2(purge.authorityId)));
      const marker = (yield* semanticCacheValue(() => purgeMarkerSha256(purge.authorityId, isolation, purge.purgedAt)));
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
    (yield* client.batch(statements, "write"));
    const placeholders = purges.map(() => "?").join(", ");
    const remaining = (yield* client.execute({
      args: purges.map(({ authorityId }) => authorityId),
      sql: `SELECT authority_id FROM oh_semantic_v1_purge_transition
      WHERE authority_id IN (${placeholders}) LIMIT 1`,
    }));
    if (remaining.rows.length !== 0) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A semantic V1 purge tombstone did not materialize exactly in V2.")));
    }
  });
}
function finishSemanticCacheV2Transition(client: SemanticCacheSqlService, appliedAt: string): Effect.Effect<void, SemanticCacheFailure, SemanticCacheSql> {
  return Effect.gen(function*() {
    const attempt = (yield* Effect.exit(Effect.gen(function*() {
      (yield* client.batch([
        {
          args: [SCHEMA_VERSION, SCHEMA_NAME, SCHEMA_SHA256, appliedAt],
          sql: `INSERT INTO oh_semantic_schemas(version, name, schema_sha256, applied_at)
          SELECT ?, CASE WHEN NOT EXISTS
            (SELECT 1 FROM oh_semantic_v1_purge_transition) THEN ? END, ?, ?`,
        },
        { sql: "DROP TABLE oh_semantic_v1_purge_transition" },
      ], "write"));
    })));
    if (Exit.isFailure(attempt)) {
      (yield* verifySchema());
    }
  });
}
function hasConvergedSemanticCacheV2(client: SemanticCacheSqlService): Effect.Effect<boolean, SemanticCacheFailure, SemanticCacheSql> {
  return Effect.gen(function*() {
    return Exit.isSuccess((yield* Effect.exit(verifySchema())));
  });
}
function resumeSemanticCacheV2Transition(client: SemanticCacheSqlService, appliedAt: string): Effect.Effect<void, SemanticCacheFailure, SemanticCacheSql> {
  return Effect.gen(function*() {
    const attempt = (yield* Effect.exit(Effect.gen(function*() {
      (yield* verifyTransitionSchema(client));
      for (; ;) {
        const page = (yield* transitionPage(client));
        if (page.length === 0)
          break;
        (yield* materializeTransitionPage(client, page));
      }
      (yield* finishSemanticCacheV2Transition(client, appliedAt));
    })));
    if (Exit.isFailure(attempt)) {
      if ((yield* hasConvergedSemanticCacheV2(client)))
        return;
      return yield* attempt;
    }
  });
}
export function bootstrapSemanticCache(options: Readonly<{
  appliedAt?: string;
}> = {}): Effect.Effect<Readonly<{
  schemaSha256: Sha256Hex;
  schemaVersion: 2;
  v: 2;
}>, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const clock = yield* SemanticCacheClock;
    const instantValue = options.appliedAt ?? (yield* clock.currentInstant);
    const appliedAt = yield* semanticCacheValue(() => parseInstant(instantValue));
    let existing = (yield* schemaObjects(client));
    if (existing.length === 0) {
      (yield* client.batch([
        { sql: SCHEMA_TABLE },
        ...SCHEMA_STATEMENTS.map((sql) => ({ sql })),
        {
          args: [SCHEMA_VERSION, SCHEMA_NAME, SCHEMA_SHA256, appliedAt],
          sql: `INSERT INTO oh_semantic_schemas(version, name, schema_sha256, applied_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING`,
        },
      ], "write"));
    }
    else if ((yield* semanticCacheValue(() => canonicalJson(existing))) === (yield* semanticCacheValue(() => canonicalJson(EXPECTED_SCHEMA_OBJECTS_V1)))) {
      (yield* startSemanticCacheV1ToV2Transition(client));
    }
    existing = (yield* schemaObjects(client));
    if ((yield* semanticCacheValue(() => canonicalJson(existing))) === (yield* semanticCacheValue(() => canonicalJson(EXPECTED_TRANSITION_SCHEMA_OBJECTS)))) {
      (yield* resumeSemanticCacheV2Transition(client, appliedAt));
    }
    else if ((yield* semanticCacheValue(() => canonicalJson(existing))) !== (yield* semanticCacheValue(() => canonicalJson(EXPECTED_SCHEMA_OBJECTS)))) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "Refusing to bless a partial or drifted semantic V2 schema.")));
    }
    (yield* verifySchema());
    return Object.freeze({ schemaSha256: SCHEMA_SHA256, schemaVersion: 2, v: 2 });
  });
}
function prepareGeneration(input: Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  createdAt?: string;
  documents: readonly OhSemanticDocumentV2[];
  generation: number;
  isolationSha256?: Sha256Hex;
  maximumChunksPerDocument?: number;
}>, clock: SemanticCacheClockService): Effect.Effect<Generation, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const authorityId = (yield* semanticCacheValue(() => parseAuthorityId(input.authorityId)));
    const authoritySha256 = (yield* semanticCacheValue(() => parseDigest(input.authoritySha256, "authority")));
    const isolation = (yield* semanticCacheValue(() => isolationSha256(authorityId, input.isolationSha256)));
    const generation = (yield* semanticCacheValue(() => parseGeneration(input.generation)));
    const instantValue = input.createdAt ?? (yield* clock.currentInstant);
    const createdAt = yield* semanticCacheValue(() => parseInstant(instantValue));
    const maximumChunks = input.maximumChunksPerDocument
      ?? OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerDocument;
    if (!Number.isSafeInteger(maximumChunks) || maximumChunks < 1
      || maximumChunks > OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerDocument
      || !Array.isArray(input.documents) || input.documents.length < 1
      || input.documents.length > OH_LIBSQL_SEMANTIC_LIMITS_V2.documentsPerGeneration) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic generation bounds.")));
    }
    const documents = (yield* semanticCacheValue(() => input.documents.map((document) => {
      if (document.v !== 2)
        throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic document version.");
      return {
        ...document,
        key: parseRecordKey(document.key),
        recordSha256: parseDigest(document.recordSha256, "record"),
      };
    }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)));
    if (new Set(documents.map(({ key }) => key)).size !== documents.length) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("invalid-input", "Semantic document keys must be unique.")));
    }
    const memberships: Membership[] = [];
    for (const document of documents) {
      const rendered = (yield* semanticCacheValue(() => renderOhCloudflareEmbeddingDocumentV1({
        content: document.content,
        maximumChunks,
        title: document.title,
      })));
      if (rendered.status !== "complete") {
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("invalid-input", "A semantic document exceeds the complete renderer bound.")));
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
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("invalid-input", "The semantic generation exceeds its chunk bound.")));
    }
    const membershipSha256 = (yield* semanticCacheValue(() => canonicalSha256({
      kind: MEMBERSHIP_KIND,
      memberships: memberships.map((membership) => ({
        inputSha256: membership.inputSha256,
        isolationSha256: isolation,
        ordinal: membership.ordinal,
        recordKey: membership.recordKey,
        recordSha256: membership.recordSha256,
      })),
      v: 2,
    })));
    const generationSha256 = (yield* semanticCacheValue(() => canonicalSha256({
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
    })));
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
  });
}
function readGeneration(client: SemanticCacheSqlService, authorityId: string, generation: number): Effect.Effect<StoredGeneration | null, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const result = (yield* client.execute({ args: [authorityId, generation], sql: GENERATION_SELECT }));
    if (result.rows.length > 1)
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic generations.")));
    const row = result.rows[0];
    return row === undefined ? null : (yield* semanticCacheValue(() => parseStoredGeneration(row)));
  });
}
function readHead(client: SemanticCacheSqlService, authorityId: string): Effect.Effect<StoredHead | null, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const result = (yield* client.execute({ args: [authorityId], sql: HEAD_SELECT }));
    if (result.rows.length > 1)
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic heads.")));
    const row = result.rows[0];
    return row === undefined ? null : (yield* semanticCacheValue(() => parseStoredHead(row)));
  });
}
function readPurge(client: SemanticCacheSqlService, authorityId: string): Effect.Effect<OhSemanticPurgeResultV2 | null, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const result = (yield* client.execute({
      args: [authorityId],
      sql: `SELECT isolation_sha256, profile_sha256, published_generation,
      published_generation_sha256, purged_at, purge_marker_sha256,
      generation_count, membership_count, orphan_vector_count,
      isolation_scope_count, counts_recorded
      FROM oh_semantic_purges WHERE authority_id = ?`,
    }));
    if (result.rows.length > 1)
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic purge markers.")));
    const row = result.rows[0];
    if (row === undefined)
      return null;
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
      || storedMarker !== (yield* semanticCacheValue(() => purgeMarkerSha256(authorityId, isolation, purgedAt)))
      || generations === null || generations < 0
      || memberships === null || memberships < 0
      || orphanVectors === null || orphanVectors < 0
      || isolationScopes === null || isolationScopes < 1
      || (countsRecordedValue !== 0 && countsRecordedValue !== 1)) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic purge marker is invalid.")));
    }
    return (yield* semanticCacheValue(() => purgeResult(Object.freeze({
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
    }))));
  });
}
function readIsolationOwner(client: SemanticCacheSqlService, isolation: Sha256Hex): Effect.Effect<string | null, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const result = (yield* client.execute({
      args: [isolation],
      sql: "SELECT authority_id FROM oh_semantic_isolations WHERE isolation_sha256 = ?",
    }));
    if (result.rows.length > 1)
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic isolations.")));
    const row = result.rows[0];
    if (row === undefined)
      return null;
    const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
    if (authorityId === null)
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A semantic isolation is invalid.")));
    return authorityId;
  });
}
function reserveIsolation(client: SemanticCacheSqlService, authorityId: string, isolation: Sha256Hex, createdAt: string): Effect.Effect<void, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    if ((yield* readPurge(client, authorityId)) !== null) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.")));
    }
    (yield* client.execute({
      args: [isolation, authorityId, createdAt, authorityId],
      sql: `INSERT INTO oh_semantic_isolations(isolation_sha256, authority_id, created_at)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
      ON CONFLICT DO NOTHING`,
    }));
    const owner = (yield* readIsolationOwner(client, isolation));
    if ((yield* readPurge(client, authorityId)) !== null) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.")));
    }
    if (owner !== authorityId) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic isolation belongs to another authority.")));
    }
  });
}
function reservePurgeIsolation(client: SemanticCacheSqlService, authorityId: string, isolation: Sha256Hex, createdAt: string): Effect.Effect<void, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const head = (yield* readHead(client, authorityId));
    if (head !== null && head.isolationSha256 !== isolation) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.")));
    }
    const owner = (yield* readIsolationOwner(client, isolation));
    if (owner !== null && owner !== authorityId) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic isolation belongs to another authority.")));
    }
    if (owner === null) {
      const existing = (yield* client.execute({
        args: [authorityId],
        sql: "SELECT isolation_sha256 FROM oh_semantic_isolations WHERE authority_id = ? LIMIT 1",
      }));
      if (existing.rows.length !== 0) {
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.")));
      }
      (yield* reserveIsolation(client, authorityId, isolation, createdAt));
    }
  });
}
function verifyPurgeResidual(client: SemanticCacheSqlService, authorityId: string): Effect.Effect<void, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const result = (yield* client.execute({
      args: [authorityId, authorityId, authorityId, authorityId],
      sql: `SELECT
      (SELECT count(*) FROM oh_semantic_heads WHERE authority_id = ?) AS heads,
      (SELECT count(*) FROM oh_semantic_generations WHERE authority_id = ?) AS generations,
      (SELECT count(*) FROM oh_semantic_memberships WHERE authority_id = ?) AS memberships,
      (SELECT count(*) FROM oh_semantic_vectors AS vector
        JOIN oh_semantic_isolations AS isolation
          ON isolation.isolation_sha256 = vector.isolation_sha256
        WHERE isolation.authority_id = ?) AS vectors`,
    }));
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined
      || integer(rowValue(row, "heads", 0)) !== 0
      || integer(rowValue(row, "generations", 1)) !== 0
      || integer(rowValue(row, "memberships", 2)) !== 0
      || integer(rowValue(row, "vectors", 3)) !== 0) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic authority purge is incomplete.")));
    }
  });
}
function readMemberships(client: SemanticCacheSqlService, generation: StoredGeneration): Effect.Effect<readonly Omit<Membership, "input">[], SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const memberships: Array<Omit<Membership, "input">> = [];
    for (let offset = 0; offset < generation.chunkCount; offset += OH_LIBSQL_SEMANTIC_LIMITS_V2.searchPage) {
      const result = (yield* client.execute({
        args: [generation.authorityId, generation.generation,
        OH_LIBSQL_SEMANTIC_LIMITS_V2.searchPage, offset],
        sql: `SELECT generation_sha256, isolation_sha256, record_key,
        record_sha256, ordinal, input_sha256
        FROM oh_semantic_memberships
        WHERE authority_id = ? AND generation = ?
        ORDER BY record_key, ordinal LIMIT ? OFFSET ?`,
      }));
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
          return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A semantic generation membership is invalid.")));
        }
        memberships.push(Object.freeze({ inputSha256, ordinal, recordKey, recordSha256 }));
      }
    }
    if (memberships.length !== generation.chunkCount
      || (yield* semanticCacheValue(() => canonicalSha256({
        kind: MEMBERSHIP_KIND,
        memberships: memberships.map((membership) => ({
          inputSha256: membership.inputSha256,
          isolationSha256: generation.isolationSha256,
          ordinal: membership.ordinal,
          recordKey: membership.recordKey,
          recordSha256: membership.recordSha256,
        })),
        v: 2,
      }))) !== generation.membershipSha256) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A semantic generation membership digest is invalid.")));
    }
    return Object.freeze(memberships);
  });
}
function readVectors(client: SemanticCacheSqlService, isolationSha256: Sha256Hex, inputSha256s: readonly Sha256Hex[]): Effect.Effect<ReadonlyMap<Sha256Hex, StoredVector>, SemanticCacheFailure, never> {
  return Effect.gen(function*() {
    const vectors = new Map<Sha256Hex, StoredVector>();
    for (let offset = 0; offset < inputSha256s.length; offset += 64) {
      const page = inputSha256s.slice(offset, offset + 64);
      if (page.length === 0)
        continue;
      const placeholders = page.map(() => "?").join(", ");
      const result = (yield* client.execute({
        args: [isolationSha256, OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          OH_SEMANTIC_RENDERER_V1.rendererSha256, ...page],
        sql: `SELECT input_sha256, vector_sha256, vector FROM oh_semantic_vectors
        WHERE isolation_sha256 = ? AND profile_sha256 = ? AND renderer_sha256 = ?
          AND input_sha256 IN (${placeholders}) ORDER BY input_sha256`,
      }));
      for (const row of result.rows) {
        const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 0));
        const vectorSha256 = parseSha256Hex(rowValue(row, "vector_sha256", 1));
        if (inputSha256 === null || vectorSha256 === null || !page.includes(inputSha256)
          || vectors.has(inputSha256)) {
          return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector identity is invalid.")));
        }
        const bytes = storedBytes(rowValue(row, "vector", 2));
        if (bytes === null) {
          return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector is corrupt.")));
        }
        (yield* semanticCacheValue(() => decodeVector(bytes, vectorSha256)));
        vectors.set(inputSha256, Object.freeze({
          bytes,
          inputSha256,
          vectorSha256,
        }));
      }
    }
    return vectors;
  });
}
export function publishedHead(input: Readonly<{
  authorityId: string;
  isolationSha256?: Sha256Hex;
}>): Effect.Effect<OhSemanticPublishedHeadV2 | null, SemanticCacheFailure, SemanticCacheSql> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const authorityId = (yield* semanticCacheValue(() => parseAuthorityId(input.authorityId)));
    const isolation = (yield* semanticCacheValue(() => isolationSha256(authorityId, input.isolationSha256)));
    if ((yield* readPurge(client, authorityId)) !== null)
      return null;
    const head = (yield* readHead(client, authorityId));
    if (head === null || head.isolationSha256 !== isolation)
      return null;
    const generation = (yield* readGeneration(client, authorityId, head.generation));
    if (generation === null || !headMatchesGeneration(head, generation)) {
      if ((yield* readPurge(client, authorityId)) !== null)
        return null;
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic published head does not match its immutable generation.")));
    }
    if ((yield* readPurge(client, authorityId)) !== null)
      return null;
    const finalHead = (yield* readHead(client, authorityId));
    if (finalHead === null) {
      if ((yield* readPurge(client, authorityId)) !== null)
        return null;
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic published head disappeared during its read.")));
    }
    if ((yield* semanticCacheValue(() => canonicalJson(finalHead))) !== (yield* semanticCacheValue(() => canonicalJson(head)))) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic published head changed during its read.")));
    }
    return Object.freeze({ ...head, v: 2 });
  });
}
export function stage(input: Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  createdAt?: string;
  documents: readonly OhSemanticDocumentV2[];
  embeddingClient: OhCloudflareEmbeddingClientV1;
  generation: number;
  isolationSha256?: Sha256Hex;
  maximumChunksPerDocument?: number;
  signal?: AbortSignal;
}>): Effect.Effect<OhSemanticStageResultV2, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock | SemanticCacheEmbedding> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const clock = yield* SemanticCacheClock;
    const embedding = yield* SemanticCacheEmbedding;
    (yield* semanticCacheValue(() => validateEmbeddingClient(input.embeddingClient)));
    const prepared = (yield* prepareGeneration(input, clock));
    (yield* reserveIsolation(client, prepared.authorityId, prepared.isolationSha256, prepared.createdAt));
    if ((yield* readPurge(client, prepared.authorityId)) !== null) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.")));
    }
    const existingGeneration = (yield* readGeneration(client, prepared.authorityId, prepared.generation));
    if (existingGeneration !== null && !generationMatches(existingGeneration, prepared)) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic generation identity conflicts.")));
    }
    const uniqueInputs = new Map<Sha256Hex, OhRenderedEmbeddingInputV1>();
    for (const membership of prepared.memberships)
      uniqueInputs.set(membership.inputSha256, membership.input);
    const orderedInputs = [...uniqueInputs.entries()].sort(([left], [right]) => left < right ? -1 : 1);
    const existingVectors = (yield* readVectors(client, prepared.isolationSha256, orderedInputs.map(([digest]) => digest)));
    const missing = orderedInputs.filter(([digest]) => !existingVectors.has(digest));
    const candidateVectors = new Map(existingVectors);
    for (let offset = 0; offset < missing.length; offset += OH_LIBSQL_SEMANTIC_LIMITS_V2.embeddingBatch) {
      const page = missing.slice(offset, offset + OH_LIBSQL_SEMANTIC_LIMITS_V2.embeddingBatch);
      const vectors = (yield* embedding.embed(input.embeddingClient, page.map(([, rendered]) => rendered), input.signal === undefined ? {} : { signal: input.signal }));
      if (vectors.length !== page.length) {
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The embedding client returned a mismatched vector batch.")));
      }
      for (const [index, [inputSha256]] of page.entries()) {
        const vector = vectors[index];
        if (vector === undefined)
          return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A semantic vector is missing.")));
        const bytes = (yield* semanticCacheValue(() => vectorBytes(vector)));
        const vectorSha256 = (yield* semanticCacheValue(() => sha256Hex(bytes)));
        (yield* semanticCacheValue(() => decodeVector(bytes, vectorSha256)));
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
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A semantic vector candidate is missing.")));
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
    (yield* client.batch(statements, "write"));
    const completeVectors = (yield* readVectors(client, prepared.isolationSha256, orderedInputs.map(([digest]) => digest)));
    if (completeVectors.size !== orderedInputs.length) {
      if ((yield* readPurge(client, prepared.authorityId)) !== null) {
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.")));
      }
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic vector cache did not converge.")));
    }
    const stored = (yield* readGeneration(client, prepared.authorityId, prepared.generation));
    if ((yield* readPurge(client, prepared.authorityId)) !== null) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.")));
    }
    if (stored === null || !generationMatches(stored, prepared)) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic generation identity conflicts.")));
    }
    const memberships = (yield* readMemberships(client, stored));
    if ((yield* semanticCacheValue(() => canonicalJson(memberships))) !== (yield* semanticCacheValue(() => canonicalJson(prepared.memberships.map((membership) => ({
      inputSha256: membership.inputSha256,
      ordinal: membership.ordinal,
      recordKey: membership.recordKey,
      recordSha256: membership.recordSha256,
    })))))) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic generation membership conflicts.")));
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
  });
}
export function publish(input: Readonly<{
  authorityId: string;
  expectedPublishedGeneration: number | null;
  generation: number;
  isolationSha256?: Sha256Hex;
  publishedAt?: string;
}>): Effect.Effect<OhSemanticPublishResultV2, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const clock = yield* SemanticCacheClock;
    const authorityId = (yield* semanticCacheValue(() => parseAuthorityId(input.authorityId)));
    const isolation = (yield* semanticCacheValue(() => isolationSha256(authorityId, input.isolationSha256)));
    const generationNumber = (yield* semanticCacheValue(() => parseGeneration(input.generation)));
    const expected = input.expectedPublishedGeneration === null
      ? null : (yield* semanticCacheValue(() => parseGeneration(input.expectedPublishedGeneration)));
    const instantValue = input.publishedAt ?? (yield* clock.currentInstant);
    const publishedAt = yield* semanticCacheValue(() => parseInstant(instantValue));
    if ((yield* readPurge(client, authorityId)) !== null) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.")));
    }
    const generation = (yield* readGeneration(client, authorityId, generationNumber));
    if (generation === null || generation.isolationSha256 !== isolation) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic generation is not staged.")));
    }
    (yield* readMemberships(client, generation));
    const before = (yield* readHead(client, authorityId));
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
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic published-head precondition failed.")));
    }
    let result: OhLibSqlResultV1;
    const values = [generation.authorityId, generation.generation,
    generation.authoritySha256, generation.isolationSha256,
    generation.profileSha256, generation.rendererSha256,
    generation.membershipSha256, generation.generationSha256, publishedAt];
    if (expected === null) {
      result = (yield* client.execute({
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
      }));
    }
    else {
      result = (yield* client.execute({
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
      }));
    }
    if ((yield* readPurge(client, authorityId)) !== null) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.")));
    }
    const after = (yield* readHead(client, authorityId));
    if (after === null || !headMatchesGeneration(after, generation)) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic published head did not converge.")));
    }
    return Object.freeze({
      authorityId,
      generation: generationNumber,
      generationSha256: generation.generationSha256,
      isolationSha256: isolation,
      published: rowsAffected(result) > 0,
      v: 2,
    });
  });
}
export function search(input: Readonly<{
  authority: OhSemanticAuthorityRefV2;
  embeddingClient: OhCloudflareEmbeddingClientV1;
  limit?: number;
  query: string;
  signal?: AbortSignal;
}>): Effect.Effect<readonly OhSemanticSearchResultV2[], SemanticCacheFailure, SemanticCacheSql | SemanticCacheEmbedding> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const embedding = yield* SemanticCacheEmbedding;
    (yield* semanticCacheValue(() => validateEmbeddingClient(input.embeddingClient)));
    const authorityId = (yield* semanticCacheValue(() => parseAuthorityId(input.authority.authorityId)));
    const authoritySha256 = (yield* semanticCacheValue(() => parseDigest(input.authority.authoritySha256, "authority")));
    const isolation = (yield* semanticCacheValue(() => isolationSha256(authorityId, input.authority.isolationSha256)));
    const authorityGeneration = (yield* semanticCacheValue(() => parseGeneration(input.authority.generation)));
    const limit = input.limit ?? 10;
    if (input.authority.v !== 2 || !Number.isSafeInteger(limit) || limit < 1
      || limit > OH_LIBSQL_SEMANTIC_LIMITS_V2.searchLimit
      || !Array.isArray(input.authority.records)
      || input.authority.records.length > OH_LIBSQL_SEMANTIC_LIMITS_V2.documentsPerGeneration) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic search authority or limit.")));
    }
    const records = new Map<string, Sha256Hex>();
    for (const record of input.authority.records) {
      const key = (yield* semanticCacheValue(() => parseRecordKey(record.key)));
      const recordSha256 = (yield* semanticCacheValue(() => parseDigest(record.recordSha256, "record")));
      if (records.has(key))
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("invalid-input", "Duplicate authority record key.")));
      records.set(key, recordSha256);
    }
    if ((yield* readPurge(client, authorityId)) !== null)
      return Object.freeze([]);
    const head = (yield* readHead(client, authorityId));
    if (head === null || head.authoritySha256 !== authoritySha256
      || head.generation !== authorityGeneration
      || head.isolationSha256 !== isolation
      || head.profileSha256 !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256
      || head.rendererSha256 !== OH_SEMANTIC_RENDERER_V1.rendererSha256) {
      return Object.freeze([]);
    }
    const generation = (yield* readGeneration(client, authorityId, authorityGeneration));
    if (generation === null || !headMatchesGeneration(head, generation))
      return Object.freeze([]);
    const renderedQuery = (yield* semanticCacheValue(() => renderOhCloudflareEmbeddingQueryV1(input.query)));
    const queryVectors = (yield* embedding.embed(input.embeddingClient, [renderedQuery], input.signal === undefined ? {} : { signal: input.signal }));
    const queryVector = queryVectors[0];
    if (queryVectors.length !== 1 || queryVector === undefined) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The query embedding response is invalid.")));
    }
    const normalizedQuery = (yield* semanticCacheValue(() => normalizeOhEmbeddingV1(queryVector)));
    const best = new Map<string, OhSemanticSearchResultV2>();
    let scanned = 0;
    for (let offset = 0; offset < generation.chunkCount; offset += OH_LIBSQL_SEMANTIC_LIMITS_V2.searchPage) {
      const result = (yield* client.execute({
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
      }));
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
          return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "A semantic search row is invalid.")));
        }
        if (records.get(key) !== recordSha256)
          continue;
        const vector = (yield* semanticCacheValue(() => decodeVector(rowValue(row, "vector", 7), vectorSha256)));
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
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("integrity", "The semantic search scan is incomplete.")));
    }
    const finalHead = (yield* readHead(client, authorityId));
    if (finalHead === null || (yield* semanticCacheValue(() => canonicalJson(finalHead))) !== (yield* semanticCacheValue(() => canonicalJson(head)))
      || (yield* readPurge(client, authorityId)) !== null)
      return Object.freeze([]);
    return Object.freeze([...best.values()]
      .sort((left, right) => right.score - left.score
        || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .slice(0, limit));
  });
}
export function purgeReceipt(input: Readonly<{
  authorityId: string;
  isolationSha256?: Sha256Hex;
}>): Effect.Effect<OhSemanticPurgeResultV2 | null, SemanticCacheFailure, SemanticCacheSql> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const authorityId = (yield* semanticCacheValue(() => parseAuthorityId(input.authorityId)));
    const isolation = (yield* semanticCacheValue(() => isolationSha256(authorityId, input.isolationSha256)));
    const receipt = (yield* readPurge(client, authorityId));
    if (receipt === null)
      return null;
    if (receipt.isolationSha256 !== isolation) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.")));
    }
    (yield* verifyPurgeResidual(client, authorityId));
    return receipt;
  });
}
export function purgeAuthority(input: Readonly<{
  authorityId: string;
  isolationSha256?: Sha256Hex;
  purgedAt?: string;
}>): Effect.Effect<OhSemanticPurgeResultV2, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock> {
  return Effect.gen(function*() {
    const client = yield* SemanticCacheSql;
    const clock = yield* SemanticCacheClock;
    const authorityId = (yield* semanticCacheValue(() => parseAuthorityId(input.authorityId)));
    const isolation = (yield* semanticCacheValue(() => isolationSha256(authorityId, input.isolationSha256)));
    const previous = (yield* readPurge(client, authorityId));
    if (previous !== null) {
      if (previous.isolationSha256 !== isolation) {
        return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.")));
      }
      (yield* verifyPurgeResidual(client, authorityId));
      return previous;
    }
    const instantValue = input.purgedAt ?? (yield* clock.currentInstant);
    const requestedAt = yield* semanticCacheValue(() => parseInstant(instantValue));
    (yield* reservePurgeIsolation(client, authorityId, isolation, requestedAt));
    const markerSha256 = (yield* semanticCacheValue(() => purgeMarkerSha256(authorityId, isolation, requestedAt)));
    (yield* client.batch([
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
    ], "write"));
    const receipt = (yield* readPurge(client, authorityId));
    if (receipt === null) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic purge identity changed before tombstoning.")));
    }
    if (receipt.isolationSha256 !== isolation) {
      return yield* Effect.fail(semanticCacheFailure(new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.")));
    }
    (yield* verifyPurgeResidual(client, authorityId));
    return receipt;
  });
}
