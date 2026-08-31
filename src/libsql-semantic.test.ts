import { describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";

import { sha256Hex, type Sha256Hex } from "./canonical";
import {
  OH_CLOUDFLARE_EMBEDDING_PROFILE_V1,
  OhCloudflareEmbeddingClientV1,
} from "./cloudflare-embedding";
import type {
  OhLibSqlClientV1,
  OhLibSqlResultV1,
  OhLibSqlStatementV1,
} from "./libsql";
import {
  bootstrapOhLibSqlSemanticCacheV1,
  OhLibSqlSemanticError,
  openOhLibSqlSemanticCacheV1,
  type OhSemanticAuthorityRefV1,
  type OhSemanticDocumentV1,
} from "./libsql-semantic";

class SqliteCompatibleLibSqlClient implements OhLibSqlClientV1 {
  readonly database = new Database(":memory:", { strict: true });

  #execute(statement: OhLibSqlStatementV1 | string): OhLibSqlResultV1 {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const args = typeof statement === "string" ? [] : statement.args ?? [];
    const bindings: SQLQueryBindings[] = args.map((value) => value instanceof Date
      ? value.toISOString() : value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    if (/^\s*(?:SELECT|PRAGMA)\b/iu.test(sql)) {
      return {
        rows: this.database.query<Record<string, unknown>, SQLQueryBindings[]>(sql).all(...bindings),
      };
    }
    const result = this.database.query<never, SQLQueryBindings[]>(sql).run(...bindings);
    return { rows: [], rowsAffected: result.changes };
  }

  async execute(statement: OhLibSqlStatementV1 | string): Promise<OhLibSqlResultV1> {
    return this.#execute(statement);
  }

  async batch(
    statements: readonly OhLibSqlStatementV1[],
    _mode?: "deferred" | "read" | "write",
  ): Promise<readonly OhLibSqlResultV1[]> {
    return this.database.transaction((items: readonly OhLibSqlStatementV1[]) =>
      items.map((statement) => this.#execute(statement)))(statements);
  }

  close(): void { this.database.close(); }
}

class InterleavingLibSqlClient extends SqliteCompatibleLibSqlClient {
  beforeVectorWrite: (() => Promise<void>) | null = null;
  afterSecondVectorRead: (() => Promise<void>) | null = null;
  #vectorReads = 0;

  override async execute(statement: OhLibSqlStatementV1 | string): Promise<OhLibSqlResultV1> {
    const result = await super.execute(statement);
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (/SELECT\s+input_sha256,\s*vector_sha256,\s*vector\s+FROM\s+oh_semantic_vectors/iu
      .test(sql)) {
      this.#vectorReads += 1;
      if (this.#vectorReads === 2 && this.afterSecondVectorRead !== null) {
        const hook = this.afterSecondVectorRead;
        this.afterSecondVectorRead = null;
        await hook();
      }
    }
    return result;
  }

  override async batch(
    statements: readonly OhLibSqlStatementV1[],
    mode?: "deferred" | "read" | "write",
  ): Promise<readonly OhLibSqlResultV1[]> {
    if (this.beforeVectorWrite !== null
      && statements.some(({ sql }) => /INSERT\s+INTO\s+oh_semantic_vectors/iu.test(sql))) {
      const hook = this.beforeVectorWrite;
      this.beforeVectorWrite = null;
      await hook();
    }
    return await super.batch(statements, mode);
  }
}

const instant1 = "2026-08-31T12:00:00.000Z";
const instant2 = "2026-08-31T12:01:00.000Z";
const instant3 = "2026-08-31T12:02:00.000Z";
const digest = (value: string): Sha256Hex => sha256Hex(value);

function unitVector(index: number): number[] {
  return Array.from(
    { length: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions },
    (_, ordinal) => ordinal === index ? 1 : 0,
  );
}

function embeddingClient(calls: string[][]): OhCloudflareEmbeddingClientV1 {
  return new OhCloudflareEmbeddingClientV1({
    accountId: "0123456789abcdef0123456789abcdef",
    apiToken: "test-token-with-no-provider-authority",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string[] };
      calls.push(body.text);
      const vectors = body.text.map((text) => unitVector(
        text.includes("needle-beta") ? 1 : text.includes("needle-gamma") ? 2 : 0,
      ));
      return Response.json({
        result: { data: vectors, shape: [vectors.length, 768] },
        success: true,
      });
    },
  });
}

function document(
  key: string,
  marker: "needle-alpha" | "needle-beta" | "needle-gamma",
): OhSemanticDocumentV1 {
  return {
    content: `private body ${marker}`,
    key,
    recordSha256: digest(`record:${key}:${marker}`),
    title: `private title ${marker}`,
    v: 1,
  };
}

async function bootstrapped(): Promise<SqliteCompatibleLibSqlClient> {
  const client = new SqliteCompatibleLibSqlClient();
  expect(await bootstrapOhLibSqlSemanticCacheV1(client, { appliedAt: instant1 }))
    .toMatchObject({ schemaVersion: 1, v: 1 });
  return client;
}

function authority(
  authorityId: string,
  generation: number,
  authoritySha256: Sha256Hex,
  documents: readonly OhSemanticDocumentV1[],
): OhSemanticAuthorityRefV1 {
  return {
    authorityId,
    authoritySha256,
    generation,
    records: documents.map(({ key, recordSha256 }) => ({ key, recordSha256 })),
    v: 1,
  };
}

describe("libSQL derived semantic cache", () => {
  test("requires explicit bootstrap and refuses a partial or drifted schema", async () => {
    const empty = new SqliteCompatibleLibSqlClient();
    await expect(openOhLibSqlSemanticCacheV1(empty)).rejects.toMatchObject({
      code: "schema-unavailable",
    });
    expect(empty.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM sqlite_schema WHERE name GLOB 'oh_semantic_*'`).get()?.count).toBe(0);
    empty.close();

    const coTenant = new SqliteCompatibleLibSqlClient();
    coTenant.database.exec("CREATE TABLE ohXsemanticYforeign(value TEXT) STRICT");
    await expect(bootstrapOhLibSqlSemanticCacheV1(coTenant, { appliedAt: instant1 }))
      .resolves.toMatchObject({ schemaVersion: 1, v: 1 });
    await expect(openOhLibSqlSemanticCacheV1(coTenant)).resolves.toBeDefined();
    coTenant.close();

    const partial = new SqliteCompatibleLibSqlClient();
    partial.database.exec("CREATE TABLE oh_semantic_foreign(value TEXT) STRICT");
    await expect(bootstrapOhLibSqlSemanticCacheV1(partial, { appliedAt: instant1 }))
      .rejects.toMatchObject({ code: "integrity" });
    partial.close();

    const drifted = await bootstrapped();
    drifted.database.exec("DROP INDEX oh_semantic_memberships_input");
    await expect(openOhLibSqlSemanticCacheV1(drifted)).rejects.toMatchObject({ code: "integrity" });
    drifted.close();

    const ownerDrift = await bootstrapped();
    ownerDrift.database.exec(`CREATE TRIGGER foreign_named_semantic_trigger
      AFTER INSERT ON oh_semantic_vectors BEGIN SELECT 1; END`);
    await expect(openOhLibSqlSemanticCacheV1(ownerDrift))
      .rejects.toMatchObject({ code: "integrity" });
    ownerDrift.close();
  });

  test("stages immutable generations, reuses vectors, publishes by CAS, and searches exactly", async () => {
    const client = await bootstrapped();
    const cache = await openOhLibSqlSemanticCacheV1(client);
    const calls: string[][] = [];
    const embedder = embeddingClient(calls);
    const authorityId = "agent:session-1:epoch-1";
    const firstDocuments = [
      document("memory:one", "needle-alpha"),
      document("memory:two", "needle-beta"),
    ] as const;
    const firstAuthoritySha256 = digest("authority:first");
    const first = await cache.stage({
      authorityId,
      authoritySha256: firstAuthoritySha256,
      createdAt: instant1,
      documents: firstDocuments,
      embeddingClient: embedder,
      generation: 1,
    });
    expect(first).toMatchObject({ chunks: 2, documents: 2, embedded: 2, reused: 0 });
    expect(calls).toHaveLength(1);
    expect(await cache.stage({
      authorityId,
      authoritySha256: firstAuthoritySha256,
      createdAt: instant2,
      documents: firstDocuments,
      embeddingClient: embedder,
      generation: 1,
    })).toMatchObject({ embedded: 0, generationSha256: first.generationSha256, reused: 2 });
    expect(calls).toHaveLength(1);

    const storedVectors = client.database.query<{
      bytes: number;
      count: number;
    }, []>("SELECT count(*) AS count, min(length(vector)) AS bytes FROM oh_semantic_vectors").get();
    expect(storedVectors).toEqual({ bytes: 3_072, count: 2 });
    const storedText = JSON.stringify(client.database.query<Record<string, unknown>, []>(`
      SELECT authority_id, authority_sha256, profile_sha256, renderer_sha256,
        membership_sha256, generation_sha256 FROM oh_semantic_generations`).all());
    expect(storedText).not.toContain("private title");
    expect(storedText).not.toContain("private body");
    expect(storedText).not.toContain("needle-alpha");

    expect(await cache.publish({
      authorityId,
      expectedPublishedGeneration: null,
      generation: 1,
      publishedAt: instant1,
    })).toMatchObject({ published: true });
    expect(await cache.publish({
      authorityId,
      expectedPublishedGeneration: null,
      generation: 1,
      publishedAt: instant2,
    })).toMatchObject({ published: false });
    expect(await cache.stage({
      authorityId,
      authoritySha256: firstAuthoritySha256,
      createdAt: instant2,
      documents: firstDocuments,
      embeddingClient: embedder,
      generation: 1,
    })).toMatchObject({ embedded: 0, generationSha256: first.generationSha256, reused: 2 });
    expect(calls).toHaveLength(1);

    const hits = await cache.search({
      authority: authority(authorityId, 1, firstAuthoritySha256, firstDocuments),
      embeddingClient: embedder,
      limit: 2,
      query: "needle-alpha",
    });
    expect(hits.map(({ key, score }) => ({ key, score }))).toEqual([
      { key: "memory:one", score: 1 },
      { key: "memory:two", score: 0 },
    ]);
    expect(await cache.search({
      authority: authority(authorityId, 1, digest("stale"), firstDocuments),
      embeddingClient: embedder,
      query: "needle-alpha",
    })).toEqual([]);
    expect((await cache.search({
      authority: authority(authorityId, 1, firstAuthoritySha256, [
        { ...firstDocuments[0], recordSha256: digest("changed") },
        firstDocuments[1],
      ]),
      embeddingClient: embedder,
      query: "needle-alpha",
    })).map(({ key, score }) => ({ key, score }))).toEqual([
      { key: "memory:two", score: 0 },
    ]);

    const secondDocuments = [
      firstDocuments[0],
      document("memory:three", "needle-gamma"),
    ] as const;
    const secondAuthoritySha256 = digest("authority:second");
    expect(await cache.stage({
      authorityId,
      authoritySha256: secondAuthoritySha256,
      createdAt: instant2,
      documents: secondDocuments,
      embeddingClient: embedder,
      generation: 2,
    })).toMatchObject({ embedded: 1, reused: 1 });
    await expect(cache.publish({
      authorityId,
      expectedPublishedGeneration: 0,
      generation: 2,
      publishedAt: instant2,
    })).rejects.toMatchObject({ code: "conflict" });
    expect(await cache.publish({
      authorityId,
      expectedPublishedGeneration: 1,
      generation: 2,
      publishedAt: instant2,
    })).toMatchObject({ published: true });
    expect(await cache.search({
      authority: authority(authorityId, 1, firstAuthoritySha256, firstDocuments),
      embeddingClient: embedder,
      query: "needle-alpha",
    })).toEqual([]);

    expect(() => client.database.query(`INSERT INTO oh_semantic_memberships(
      authority_id, generation, generation_sha256, record_key, record_sha256,
      ordinal, input_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(authorityId, 2, digest("generation"), "memory:late", digest("late"), 0, digest("late")))
      .toThrow("published");
    await cache.close();
    client.close();
  });

  test("tombstones a purged authority, preserves shared vectors, and prevents reuse", async () => {
    const client = await bootstrapped();
    const cache = await openOhLibSqlSemanticCacheV1(client);
    const calls: string[][] = [];
    const embedder = embeddingClient(calls);
    const shared = [document("memory:shared", "needle-alpha")] as const;
    for (const authorityId of ["agent:session-a:epoch-1", "agent:session-b:epoch-1"] as const) {
      await cache.stage({
        authorityId,
        authoritySha256: digest(authorityId),
        createdAt: instant1,
        documents: shared,
        embeddingClient: embedder,
        generation: 1,
      });
      await cache.publish({
        authorityId,
        expectedPublishedGeneration: null,
        generation: 1,
        publishedAt: instant1,
      });
    }
    expect(calls).toHaveLength(1);
    expect((await cache.purgeAuthority({
      authorityId: "agent:session-a:epoch-1",
      purgedAt: instant2,
    })).orphanVectors).toBe(0);
    expect(client.database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_semantic_vectors",
    ).get()?.count).toBe(1);
    await expect(cache.stage({
      authorityId: "agent:session-a:epoch-1",
      authoritySha256: digest("replacement"),
      createdAt: instant3,
      documents: shared,
      embeddingClient: embedder,
      generation: 2,
    })).rejects.toMatchObject({ code: "purged" });
    expect(await cache.search({
      authority: authority("agent:session-a:epoch-1", 1,
        digest("agent:session-a:epoch-1"), shared),
      embeddingClient: embedder,
      query: "needle-alpha",
    })).toEqual([]);

    expect((await cache.purgeAuthority({
      authorityId: "agent:session-b:epoch-1",
      purgedAt: instant3,
    })).orphanVectors).toBe(1);
    expect((await cache.purgeAuthority({
      authorityId: "agent:session-b:epoch-1",
      purgedAt: "2026-08-31T12:03:00.000Z",
    })).purgedAt).toBe(instant3);
    expect(client.database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_semantic_vectors",
    ).get()?.count).toBe(0);
    await cache.close();
    client.close();
  });

  test("keeps an unrelated in-flight stage intact across global orphan collection", async () => {
    const client = new InterleavingLibSqlClient();
    await bootstrapOhLibSqlSemanticCacheV1(client, { appliedAt: instant1 });
    const cache = await openOhLibSqlSemanticCacheV1(client);
    const documents = [document("memory:in-flight", "needle-alpha")] as const;
    let concurrentPurge: Awaited<ReturnType<typeof cache.purgeAuthority>> | null = null;
    client.afterSecondVectorRead = async () => {
      concurrentPurge = await cache.purgeAuthority({
        authorityId: "agent:unrelated:epoch-1",
        purgedAt: instant2,
      });
    };

    await cache.stage({
      authorityId: "agent:in-flight:epoch-1",
      authoritySha256: digest("authority:in-flight"),
      createdAt: instant1,
      documents,
      embeddingClient: embeddingClient([]),
      generation: 1,
    });

    expect(concurrentPurge).toMatchObject({ orphanVectors: 0 });
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_semantic_memberships AS membership
      LEFT JOIN oh_semantic_vectors AS vector
        ON vector.profile_sha256 = '${OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256}'
        AND vector.renderer_sha256 = (SELECT renderer_sha256 FROM oh_semantic_generations
          WHERE authority_id = membership.authority_id AND generation = membership.generation)
        AND vector.input_sha256 = membership.input_sha256
      WHERE membership.authority_id = 'agent:in-flight:epoch-1' AND vector.input_sha256 IS NULL`)
      .get()?.count).toBe(0);
    await cache.close();
    client.close();
  });

  test("does not write a vector after the same authority purge has completed", async () => {
    const client = new InterleavingLibSqlClient();
    await bootstrapOhLibSqlSemanticCacheV1(client, { appliedAt: instant1 });
    const cache = await openOhLibSqlSemanticCacheV1(client);
    const authorityId = "agent:purge-race:epoch-1";
    client.beforeVectorWrite = async () => {
      await cache.purgeAuthority({ authorityId, purgedAt: instant2 });
    };

    await expect(cache.stage({
      authorityId,
      authoritySha256: digest("authority:purge-race"),
      createdAt: instant1,
      documents: [document("memory:purge-race", "needle-alpha")],
      embeddingClient: embeddingClient([]),
      generation: 1,
    })).rejects.toMatchObject({ code: "purged" });
    expect(client.database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_semantic_vectors",
    ).get()?.count).toBe(0);
    expect(client.database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_semantic_generations",
    ).get()?.count).toBe(0);
    await cache.close();
    client.close();
  });

  test("fails closed on changed generation identity and invalid authority inputs", async () => {
    const client = await bootstrapped();
    const cache = await openOhLibSqlSemanticCacheV1(client);
    const embedder = embeddingClient([]);
    const documents = [document("memory:one", "needle-alpha")] as const;
    await cache.stage({
      authorityId: "agent:session-1:epoch-1",
      authoritySha256: digest("first"),
      createdAt: instant1,
      documents,
      embeddingClient: embedder,
      generation: 1,
    });
    await expect(cache.stage({
      authorityId: "agent:session-1:epoch-1",
      authoritySha256: digest("different"),
      createdAt: instant2,
      documents,
      embeddingClient: embedder,
      generation: 1,
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(cache.search({
      authority: {
        authorityId: "INVALID",
        authoritySha256: digest("first"),
        generation: 1,
        records: [],
        v: 1,
      },
      embeddingClient: embedder,
      query: "needle-alpha",
    })).rejects.toBeInstanceOf(OhLibSqlSemanticError);
    await cache.close();
    client.close();
  });
});
