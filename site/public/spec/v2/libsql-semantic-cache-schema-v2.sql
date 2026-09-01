CREATE TABLE IF NOT EXISTS oh_semantic_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS oh_semantic_isolations (
    isolation_sha256 TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

CREATE TABLE IF NOT EXISTS oh_semantic_vectors (
    isolation_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    vector_sha256 TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(isolation_sha256, profile_sha256, renderer_sha256, input_sha256)
  ) STRICT;

CREATE TABLE IF NOT EXISTS oh_semantic_generations (
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
  ) STRICT;

CREATE TABLE IF NOT EXISTS oh_semantic_memberships (
    authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    generation_sha256 TEXT NOT NULL,
    isolation_sha256 TEXT NOT NULL,
    record_key TEXT NOT NULL,
    record_sha256 TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    input_sha256 TEXT NOT NULL,
    PRIMARY KEY(authority_id, generation, record_key, ordinal)
  ) STRICT;

CREATE TABLE IF NOT EXISTS oh_semantic_heads (
    authority_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    authority_sha256 TEXT NOT NULL,
    isolation_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    membership_sha256 TEXT NOT NULL,
    generation_sha256 TEXT NOT NULL,
    published_at TEXT NOT NULL
  ) STRICT;

CREATE TABLE IF NOT EXISTS oh_semantic_purges (
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
  ) STRICT;

CREATE INDEX IF NOT EXISTS oh_semantic_isolations_authority
    ON oh_semantic_isolations(authority_id, isolation_sha256);

CREATE INDEX IF NOT EXISTS oh_semantic_memberships_generation
    ON oh_semantic_memberships(authority_id, generation, record_key, ordinal);

CREATE INDEX IF NOT EXISTS oh_semantic_memberships_input
    ON oh_semantic_memberships(isolation_sha256, input_sha256);

CREATE TRIGGER IF NOT EXISTS oh_semantic_isolations_no_update
    BEFORE UPDATE ON oh_semantic_isolations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic isolations are immutable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_isolations_no_delete
    BEFORE DELETE ON oh_semantic_isolations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic isolations are immutable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_isolations_purge_guard
    BEFORE INSERT ON oh_semantic_isolations
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_vectors_no_update
    BEFORE UPDATE ON oh_semantic_vectors
    BEGIN SELECT RAISE(ABORT, 'Oh semantic vectors are immutable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_vectors_isolation_guard
    BEFORE INSERT ON oh_semantic_vectors
    WHEN NOT EXISTS (SELECT 1 FROM oh_semantic_isolations
      WHERE isolation_sha256 = NEW.isolation_sha256)
      OR EXISTS (SELECT 1 FROM oh_semantic_purges AS purge
        JOIN oh_semantic_isolations AS isolation
          ON isolation.authority_id = purge.authority_id
        WHERE isolation.isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic vector isolation is unavailable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_no_update
    BEFORE UPDATE ON oh_semantic_generations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generations are immutable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_no_update
    BEFORE UPDATE ON oh_semantic_memberships
    BEGIN SELECT RAISE(ABORT, 'Oh semantic memberships are immutable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_purge_guard
    BEFORE INSERT ON oh_semantic_generations
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_isolations
        WHERE isolation_sha256 = NEW.isolation_sha256 AND authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_purge_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_generations
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_published_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_heads
      WHERE authority_id = NEW.authority_id AND generation = NEW.generation)
      AND NOT EXISTS (SELECT 1 FROM oh_semantic_memberships
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256
          AND record_key = NEW.record_key AND record_sha256 = NEW.record_sha256
          AND ordinal = NEW.ordinal AND input_sha256 = NEW.input_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generation is published'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_insert_purge_guard
    BEFORE INSERT ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_generations
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_update_purge_guard
    BEFORE UPDATE ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_generations
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_update
    BEFORE UPDATE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END;

CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_delete
    BEFORE DELETE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END;
