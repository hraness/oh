import type { Sha256Hex } from "./canonical";
import type { OhCloudflareEmbeddingClientV1 } from "./cloudflare-embedding";
import type { OhLibSqlClientV1 } from "./libsql";
import type {
  OhSemanticAuthorityRefV2,
  OhSemanticDocumentV2,
  OhSemanticStageResultV2,
  OhSemanticPublishResultV2,
  OhSemanticPublishedHeadV2,
  OhSemanticSearchResultV2,
  OhSemanticPurgeResultV2,
} from "./libsql-semantic-v2-model";
export { OH_LIBSQL_SEMANTIC_LIMITS_V2, OhLibSqlSemanticV2Error, deriveOhSemanticIsolationSha256V2 } from "./libsql-semantic-v2-model";
export type { OhSemanticAuthorityRefV2, OhSemanticDocumentV2, OhSemanticStageResultV2, OhSemanticPublishResultV2, OhSemanticPublishedHeadV2, OhSemanticSearchResultV2, OhSemanticPurgeResultV2 } from "./libsql-semantic-v2-model";
import * as program from "./libsql-semantic-v2-program";
import {
  openSemanticCacheRuntime,
  bootstrapSemanticCacheRuntime,
  type SemanticCacheRuntime,
} from "./libsql-semantic-v2-runtime";

export async function bootstrapOhLibSqlSemanticCacheV2(
  client: OhLibSqlClientV1,
  options: Readonly<{ appliedAt?: string; }> = {},
): Promise<Readonly<{ schemaSha256: Sha256Hex; schemaVersion: 2; v: 2; }>> { return bootstrapSemanticCacheRuntime(client, options); }

export class OhLibSqlSemanticCacheV2 {
  readonly #runtime: SemanticCacheRuntime;
  private constructor(runtime: SemanticCacheRuntime) { this.#runtime = runtime; }
  /** @internal Public callers should use `openOhLibSqlSemanticCacheV2`. */
  static async open(client: OhLibSqlClientV1, closeClient: boolean): Promise<OhLibSqlSemanticCacheV2> {
    return new OhLibSqlSemanticCacheV2(await openSemanticCacheRuntime(client, closeClient));
  }
  async close(): Promise<void> { return this.#runtime.close(); }
  async publishedHead(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
  }>): Promise<OhSemanticPublishedHeadV2 | null> { return this.#runtime.run(program.publishedHead(input)); }

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
  }>): Promise<OhSemanticStageResultV2> { return this.#runtime.run(program.stage(input)); }

  async publish(input: Readonly<{
    authorityId: string;
    expectedPublishedGeneration: number | null;
    generation: number;
    isolationSha256?: Sha256Hex;
    publishedAt?: string;
  }>): Promise<OhSemanticPublishResultV2> { return this.#runtime.run(program.publish(input)); }

  async search(input: Readonly<{
    authority: OhSemanticAuthorityRefV2;
    embeddingClient: OhCloudflareEmbeddingClientV1;
    limit?: number;
    query: string;
    signal?: AbortSignal;
  }>): Promise<readonly OhSemanticSearchResultV2[]> { return this.#runtime.run(program.search(input)); }

  async purgeReceipt(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
  }>): Promise<OhSemanticPurgeResultV2 | null> { return this.#runtime.run(program.purgeReceipt(input)); }

  async purgeAuthority(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
    purgedAt?: string;
  }>): Promise<OhSemanticPurgeResultV2> { return this.#runtime.run(program.purgeAuthority(input)); }
}

export async function openOhLibSqlSemanticCacheV2(
  client: OhLibSqlClientV1,
  options: Readonly<{ closeClient?: boolean; }> = {},
): Promise<OhLibSqlSemanticCacheV2> {
  return await OhLibSqlSemanticCacheV2.open(client, options.closeClient ?? false);
}
